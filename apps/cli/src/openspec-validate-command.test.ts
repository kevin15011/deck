/**
 * Tests for the openspec validate CLI command.
 *
 * Tests:
 * - JSON output matches schema
 * - Exit code 0 for warnings-only
 * - Exit code 1 for errors present
 * - Exit code 2 for runtime failure
 * - stdout/stderr separation
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runOpenspecValidate, type ValidateCommandResult } from "./openspec-validate-command";

describe("runOpenspecValidate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validate-cli-test-"));
    await fs.mkdir(path.join(tempDir, "openspec", "changes"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("JSON output matches schema", async () => {
    // Create valid change
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "test-change"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "test-change", "state.yaml"),
      `schema: spec-registry-v1
changeId: test-change
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
      path.join(tempDir, "openspec", "changes", "test-change", "exploration.md"),
      "# Test"
    );

    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, changeId: "test-change", root: tempDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.json).toBeDefined();
    const json = result.json as Record<string, unknown>;
    expect(json.schema).toBe("openspec-registry-validation-result-v1");
    expect(json.ok).toBe(true);
    expect(json.command).toBe("deck openspec validate");
  });

  test("Exit code 0 for warnings-only", async () => {
    // Create legacy change (warnings, no errors)
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "legacy"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "legacy", "state.yaml"),
      `changeId: legacy
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
      path.join(tempDir, "openspec", "changes", "legacy", "exploration.md"),
      "# Test"
    );

    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, changeId: "legacy", root: tempDir },
    });

    expect(result.exitCode).toBe(0);
    const json = result.json as Record<string, unknown>;
    expect((json.summary as Record<string, number>).totalErrors).toBe(0);
    expect((json.summary as Record<string, number>).totalWarnings).toBeGreaterThan(0);
  });

  test("Exit code 1 for errors present", async () => {
    // Create change with missing required field
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "broken"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "broken", "state.yaml"),
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

    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, changeId: "broken", root: tempDir },
    });

    expect(result.exitCode).toBe(1);
    const json = result.json as Record<string, unknown>;
    expect((json.summary as Record<string, number>).totalErrors).toBeGreaterThan(0);
  });

  test("Exit code 2 for runtime failure - nonexistent change", async () => {
    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, changeId: "nonexistent-change", root: tempDir },
    });

    expect(result.exitCode).toBe(2);
    expect(result.json).toBeDefined();
    const json = result.json as Record<string, unknown>;
    expect((json.summary as Record<string, number>).totalErrors).toBeGreaterThan(0);
  });

  test("Exit code 2 for runtime failure - nonexistent root", async () => {
    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, root: "/nonexistent/path" },
    });

    expect(result.exitCode).toBe(2);
    expect(result.error).toBeDefined();
  });

  test("Human output mode works", async () => {
    // Create valid change
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "human-test"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "human-test", "state.yaml"),
      `schema: spec-registry-v1
changeId: human-test
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
      path.join(tempDir, "openspec", "changes", "human-test", "exploration.md"),
      "# Test"
    );

    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { changeId: "human-test", root: tempDir },
    });

    expect(result.exitCode).toBe(0);
    expect(result.human).toBeDefined();
    expect(result.human).toContain("OpenSpec Registry Validation");
  });

  test("Full validation mode - no changeId", async () => {
    // Create valid change
    await fs.mkdir(path.join(tempDir, "openspec", "changes", "full-test"));
    await fs.writeFile(
      path.join(tempDir, "openspec", "changes", "full-test", "state.yaml"),
      `schema: spec-registry-v1
changeId: full-test
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
      path.join(tempDir, "openspec", "changes", "full-test", "exploration.md"),
      "# Test"
    );

    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, root: tempDir },
    });

    expect(result.exitCode).toBe(0);
    const json = result.json as Record<string, unknown>;
    expect((json.summary as Record<string, number>).totalChanges).toBe(1);
  });

  test("--change finds archived change", async () => {
    await fs.mkdir(path.join(tempDir, "openspec", "archive", "archived-cli"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "openspec", "archive", "archived-cli", "state.yaml"),
      `schema: spec-registry-v1
changeId: archived-cli
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
      path.join(tempDir, "openspec", "archive", "archived-cli", "events.yaml"),
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
      await fs.writeFile(path.join(tempDir, "openspec", "archive", "archived-cli", file), `# ${file}`);
    }

    const result = await runOpenspecValidate({
      command: "openspec-validate",
      flags: { json: true, changeId: "archived-cli", root: tempDir },
    });

    expect(result.exitCode).toBe(0);
    const json = result.json as Record<string, unknown>;
    expect((json.summary as Record<string, number>).totalArchivedChanges).toBe(1);
    expect(json.changes).toContainEqual(
      expect.objectContaining({
        changeId: "archived-cli",
        location: "archive",
      })
    );
    expect(json.issues).not.toContainEqual(
      expect.objectContaining({ rule: "change.not_found" })
    );
  });
});

const FENCE = String.fromCharCode(96).repeat(3) + "yaml\n";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRepairIncidentYAML,
  type RepairIncident,
  type RepairIncidentValidationResult,
} from "./repair-incident";

const VALID_FIXTURE =
  FENCE +
  "schema: repair-incident-v1\n" +
  "incidentId: repair-bounded-developer-team-repair-loops-001\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: open\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures:\n" +
  "  - id: fp-test-001\n" +
  "    status: open\n" +
  "    sourcePhase: verify\n" +
  "    taskGroup: \"Task 1\"\n" +
  "    ownerHint: General Apply\n" +
  "    failingContract: REQ-BRL-001\n" +
  "    requirementIds:\n" +
  "      - REQ-BRL-001\n" +
  "      - REQ-BRL-002\n" +
  "    scenarioIds: []\n" +
  "    errorClass: assertion\n" +
  "    changedFiles:\n" +
  "      - packages/example/src/file.ts\n" +
  "    evidence:\n" +
  "      command: bun test packages/sdd-runtime\n" +
  "      latestResult: fail\n" +
  "      artifact: verify-report.md\n" +
  "      excerpt: \"Expected 1 but got 0\"\n" +
  "    attempts:\n" +
  "      count: 1\n" +
  "      history:\n" +
  "        - attempt: 1\n" +
  "          phase: apply\n" +
  "          artifact: apply-progress.md\n" +
  "          summary: scoped fix attempted\n" +
  "          verificationStage: targeted\n" +
  "          result: failed\n" +
  "    generatedArtifacts:\n" +
  "      - path: apps/cli/src/runtime/build-info.generated.ts\n" +
  "        classification: checked_in_deterministic\n" +
  "        generator: scripts/generate-build-info.ts\n" +
  "        regenerationCommand: bun scripts/generate-build-info.ts --target linux-x64\n" +
  "        evidence: target explicitly parameterized; no host-inferred value committed\n" +
  "    nextVerificationStage: targeted\n" +
  "    nextAction: repair\n" +
  "  - id: fp-test-002\n" +
  "    status: open\n" +
  "    sourcePhase: apply\n" +
  "    taskGroup: \"Task 2\"\n" +
  "    failingContract: REQ-SRV-001\n" +
  "    errorClass: typecheck\n" +
  "    evidence:\n" +
  "      command: bunx tsc --noEmit\n" +
  "      latestResult: fail\n" +
  "      artifact: apply-progress.md\n" +
  "      excerpt: \"Type 'string | null' is not assignable to type 'string'\"\n" +
  "    attempts:\n" +
  "      count: 0\n" +
  "      history: []\n" +
  "    nextVerificationStage: targeted\n" +
  "    nextAction: verify\n" +
  "lifecycle:\n" +
  "  - event: repair.started\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: initial failure manifest created\n" +
  FENCE + " ";

const VALID_FIXTURE_CHECKPOINT =
  FENCE +
  "schema: repair-incident-v1\n" +
  "incidentId: repair-bounded-developer-team-repair-loops-002\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: checkpoint\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures:\n" +
  "  - id: fp-check-001\n" +
  "    status: checkpoint\n" +
  "    sourcePhase: verify\n" +
  "    taskGroup: \"Task 1\"\n" +
  "    failingContract: REQ-BRL-001\n" +
  "    requirementIds:\n" +
  "      - REQ-BRL-001\n" +
  "    scenarioIds: []\n" +
  "    errorClass: build\n" +
  "    evidence:\n" +
  "      command: bun test packages/sdd-runtime\n" +
  "      latestResult: fail\n" +
  "      artifact: verify-report.md\n" +
  "      excerpt: \"Expected 1 but got 0\"\n" +
  "    attempts:\n" +
  "      count: 2\n" +
  "      history:\n" +
  "        - attempt: 1\n" +
  "          phase: apply\n" +
  "          artifact: apply-progress.md\n" +
  "          summary: first attempt\n" +
  "          verificationStage: targeted\n" +
  "          result: failed\n" +
  "        - attempt: 2\n" +
  "          phase: verify\n" +
  "          artifact: verify-report.md\n" +
  "          summary: second attempt\n" +
  "          verificationStage: targeted\n" +
  "          result: failed\n" +
  "    nextVerificationStage: targeted\n" +
  "    nextAction: repair\n" +
  "  - id: fp-check-002\n" +
  "    status: open\n" +
  "    sourcePhase: apply\n" +
  "    taskGroup: \"Task 2\"\n" +
  "    failingContract: REQ-SRV-001\n" +
  "    errorClass: typecheck\n" +
  "    evidence:\n" +
  "      command: bunx tsc --noEmit\n" +
  "      latestResult: fail\n" +
  "      artifact: apply-progress.md\n" +
  "      excerpt: \"Type 'string | null' is not assignable to type 'string'\"\n" +
  "    attempts:\n" +
  "      count: 1\n" +
  "      history:\n" +
  "        - attempt: 1\n" +
  "          phase: verify\n" +
  "          artifact: verify-report.md\n" +
  "          summary: third attempt\n" +
  "          verificationStage: targeted\n" +
  "          result: failed\n" +
  "    nextVerificationStage: targeted\n" +
  "    nextAction: verify\n" +
  "lifecycle:\n" +
  "  - event: repair.started\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: initial failure manifest created\n" +
  "  - event: repair.retry_recorded\n" +
  "    phase: apply\n" +
  "    artifact: apply-progress.md\n" +
  "    at: \"2026-06-22T10:30:00Z\"\n" +
  "    summary: second attempt recorded\n" +
  "  - event: repair.checkpoint_reached\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T11:00:00Z\"\n" +
  "    summary: soft checkpoint reached at 2 verify cycles\n" +
  FENCE + " ";

const MISSING_SCHEMA_FIXTURE =
  FENCE +
  "incidentId: repair-test-001\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: open\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures: []\n" +
  "lifecycle:\n" +
  "  - event: repair.started\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: no schema field\n" +
  FENCE + " ";

const INVALID_STATUS_FIXTURE =
  FENCE +
  "schema: repair-incident-v1\n" +
  "incidentId: repair-test-001\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: invalid_status\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures: []\n" +
  "lifecycle:\n" +
  "  - event: repair.started\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: invalid status\n" +
  FENCE + " ";

const INVALID_ERROR_CLASS_FIXTURE =
  FENCE +
  "schema: repair-incident-v1\n" +
  "incidentId: repair-test-001\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: open\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures:\n" +
  "  - id: fp-test-001\n" +
  "    status: open\n" +
  "    sourcePhase: verify\n" +
  "    taskGroup: \"Task 1\"\n" +
  "    failingContract: REQ-BRL-001\n" +
  "    errorClass: invalid_error_class\n" +
  "    evidence:\n" +
  "      command: bun test packages/sdd-runtime\n" +
  "      latestResult: fail\n" +
  "      artifact: verify-report.md\n" +
  "      excerpt: \"Expected 1 but got 0\"\n" +
  "    attempts:\n" +
  "      count: 0\n" +
  "      history: []\n" +
  "    nextVerificationStage: targeted\n" +
  "    nextAction: verify\n" +
  "lifecycle:\n" +
  "  - event: repair.started\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: invalid error class\n" +
  FENCE + " ";

const MISSING_FAILURE_ID_FIXTURE =
  FENCE +
  "schema: repair-incident-v1\n" +
  "incidentId: repair-test-001\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: open\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures:\n" +
  "  - id: \"\"\n" +
  "    status: open\n" +
  "    sourcePhase: verify\n" +
  "    taskGroup: \"Task 1\"\n" +
  "    failingContract: REQ-BRL-001\n" +
  "    errorClass: assertion\n" +
  "    evidence:\n" +
  "      command: bun test packages/sdd-runtime\n" +
  "      latestResult: fail\n" +
  "      artifact: verify-report.md\n" +
  "      excerpt: \"Expected 1 but got 0\"\n" +
  "    attempts:\n" +
  "      count: 0\n" +
  "      history: []\n" +
  "    nextVerificationStage: targeted\n" +
  "    nextAction: verify\n" +
  "lifecycle:\n" +
  "  - event: repair.started\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: missing failure id\n" +
  FENCE + " ";

const MISSING_LIFECYCLE_EVENT_FIXTURE =
  FENCE +
  "schema: repair-incident-v1\n" +
  "incidentId: repair-test-001\n" +
  "changeId: bounded-developer-team-repair-loops\n" +
  "status: open\n" +
  "createdFrom:\n" +
  "  phase: verify\n" +
  "  artifact: verify-report.md\n" +
  "budgets:\n" +
  "  incident:\n" +
  "    verifyCyclesSoft: 2\n" +
  "    verifyCyclesHard: 4\n" +
  "    repairAttemptsSoft: 2\n" +
  "    repairAttemptsHard: 4\n" +
  "  fingerprint:\n" +
  "    repairThreshold: 2\n" +
  "    replanThreshold: 3\n" +
  "    escalationThreshold: 4\n" +
  "failures: []\n" +
  "lifecycle:\n" +
  "  - event: invalid.event.name\n" +
  "    phase: verify\n" +
  "    artifact: verify-report.md\n" +
  "    at: \"2026-06-22T10:00:00Z\"\n" +
  "    summary: invalid lifecycle event\n" +
  FENCE + " ";

const EMPTY_FIXTURE = "";

const NO_YAML_BLOCK_FIXTURE = "# repair-incident.md\n\nNo YAML block here.";

const FIXTURE_DIR = join(import.meta.dir, "..", "__tests__", "fixtures", "repair-incident");

describe("parseRepairIncidentYAML", () => {
  test("parses valid fixture with two failure entries", () => {
    const result = parseRepairIncidentYAML(VALID_FIXTURE);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toBeDefined();
    expect(result.data!.schema).toBe("repair-incident-v1");
    expect(result.data!.incidentId).toBe("repair-bounded-developer-team-repair-loops-001");
    expect(result.data!.status).toBe("open");
    expect(result.data!.failures).toHaveLength(2);
    expect(result.data!.failures[0]!.id).toBe("fp-test-001");
    expect(result.data!.failures[0]!.errorClass).toBe("assertion");
    expect(result.data!.failures[1]!.id).toBe("fp-test-002");
    expect(result.data!.lifecycle).toHaveLength(1);
    expect(result.data!.lifecycle[0]!.event).toBe("repair.started");
  });

  test("parses valid checkpoint fixture with history", () => {
    const result = parseRepairIncidentYAML(VALID_FIXTURE_CHECKPOINT);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data!.status).toBe("checkpoint");
    expect(result.data!.failures).toHaveLength(2);
    expect(result.data!.lifecycle).toHaveLength(3);
  });

  test("rejects empty content", () => {
    const result = parseRepairIncidentYAML(EMPTY_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("empty"))).toBe(true);
  });

  test("rejects content without YAML block", () => {
    const result = parseRepairIncidentYAML(NO_YAML_BLOCK_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("No fenced YAML"))).toBe(true);
  });

  test("rejects missing schema", () => {
    const result = parseRepairIncidentYAML(MISSING_SCHEMA_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("Schema mismatch"))).toBe(true);
  });

  test("rejects invalid incident status enum", () => {
    const result = parseRepairIncidentYAML(INVALID_STATUS_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("root.status: invalid"))).toBe(true);
  });

  test("rejects invalid errorClass enum", () => {
    const result = parseRepairIncidentYAML(INVALID_ERROR_CLASS_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("failures[0].errorClass: invalid"))).toBe(true);
  });

  test("rejects failure entry missing id", () => {
    const result = parseRepairIncidentYAML(MISSING_FAILURE_ID_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("failures[0].id: expected non-empty string"))).toBe(true);
  });

  test("rejects invalid lifecycle event name", () => {
    const result = parseRepairIncidentYAML(MISSING_LIFECYCLE_EVENT_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("lifecycle[0].event: invalid"))).toBe(true);
  });

  test("parses valid repair-incident.md fixture from disk", () => {
    const fixture = readFileSync(join(FIXTURE_DIR, "valid.md"), "utf-8");
    const result = parseRepairIncidentYAML(fixture);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.failures).toHaveLength(2);
    expect(result.data?.failures[0]?.attempts.history).toHaveLength(1);
    expect(result.data?.failures[0]?.generatedArtifacts?.[0]?.classification).toBe("not_generated");
  });

  test("rejects invalid repair-incident.md fixture with field-level errors", () => {
    const fixture = readFileSync(join(FIXTURE_DIR, "invalid.md"), "utf-8");
    const result = parseRepairIncidentYAML(fixture);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("root.status: invalid"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].id: expected non-empty string"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].nextVerificationStage"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].nextAction"));
  });

  test("rejects invalid nested schema fields with deterministic paths", () => {
    const broken = VALID_FIXTURE
      .replace("verifyCyclesSoft: 2", "verifyCyclesSoft: nope")
      .replace("phase: verify", "phase: invalid_phase")
      .replace("latestResult: fail", "latestResult: maybe")
      .replace("count: 1", "count: -1")
      .replace("attempt: 1", "attempt: nope")
      .replace("classification: checked_in_deterministic", "classification: invalid_classification")
      .replace("at: \"2026-06-22T10:00:00Z\"", "at: \"\"");
    const result = parseRepairIncidentYAML(broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("createdFrom.phase: invalid"));
    expect(result.errors).toContainEqual(expect.stringContaining("budgets.incident.verifyCyclesSoft"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].evidence.latestResult: invalid"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].attempts.count"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].attempts.history[0].attempt"));
    expect(result.errors).toContainEqual(expect.stringContaining("failures[0].generatedArtifacts[0].classification: invalid"));
    expect(result.errors).toContainEqual(expect.stringContaining("lifecycle[0].at"));
  });
});

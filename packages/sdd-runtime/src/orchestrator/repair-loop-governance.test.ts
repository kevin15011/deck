import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateRepairIncident,
  type RepairGovernanceConfig,
} from "./repair-loop-governance";
import { DEFAULT_LOOP_BREAKER_CONFIG } from "./loop-breaker";
import { DEFAULT_BUDGET_CONFIG } from "./budget-watchdog";
import type {
  RepairIncident,
  RepairFailureEntry,
} from "../contracts/repair-incident";
import { parseRepairIncidentYAML } from "../contracts/repair-incident";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const makeIncident = (overrides: Partial<RepairIncident> = {}): RepairIncident => ({
  schema: "repair-incident-v1",
  incidentId: "repair-test-001",
  changeId: "bounded-developer-team-repair-loops",
  status: "open",
  createdFrom: { phase: "verify", artifact: "verify-report.md" },
  budgets: {
    incident: {
      verifyCyclesSoft: 2,
      verifyCyclesHard: 4,
      repairAttemptsSoft: 2,
      repairAttemptsHard: 4,
    },
    fingerprint: {
      repairThreshold: 2,
      replanThreshold: 3,
      escalationThreshold: 4,
    },
  },
  failures: [],
  lifecycle: [
    {
      event: "repair.started",
      phase: "verify",
      artifact: "verify-report.md",
      at: "2026-06-22T10:00:00Z",
      summary: "initial failure manifest created",
    },
  ],
  ...overrides,
});

const makeFailure = (
  id: string,
  overrides: Partial<RepairFailureEntry> = {},
): RepairFailureEntry => ({
  id,
  status: "open",
  sourcePhase: "verify",
  taskGroup: "Task 1",
  failingContract: "REQ-BRL-001",
  errorClass: "assertion",
  evidence: {
    command: "bun test packages/sdd-runtime",
    latestResult: "fail",
    artifact: "verify-report.md",
    excerpt: "Expected 1 but got 0",
  },
  attempts: { count: 0, history: [] },
  nextVerificationStage: "targeted",
  nextAction: "repair",
  ...overrides,
});

const fp1 = {
  phase: "verify",
  taskGroup: "Task 1",
  failingContract: "REQ-BRL-001",
  errorClass: "assertion",
  changedFiles: ["packages/example/src/file.ts"],
  reviewFindingHash: "",
};

const fp2 = {
  phase: "apply",
  taskGroup: "Task 2",
  failingContract: "REQ-SRV-001",
  errorClass: "typecheck",
  changedFiles: ["packages/srv/main.ts"],
  reviewFindingHash: "",
};

const FIXTURE_DIR = join(import.meta.dir, "..", "__tests__", "fixtures", "repair-incident");

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("evaluateRepairIncident", () => {
  describe("continue", () => {
    test("returns continue when no active failures exist", () => {
      const incident = makeIncident({ failures: [] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("continue");
      expect(result.perFailure).toHaveLength(0);
    });

    test("returns continue when failures exist but no loop threshold is hit", () => {
      const failure = makeFailure("fp-001", {
        fingerprint: fp1,
        attempts: { count: 0, history: [] },
      });
      const incident = makeIncident({ failures: [failure] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("continue");
      expect(result.perFailure).toHaveLength(1);
      expect(result.perFailure[0]!.loopAction.action).toBe("continue");
    });

    test("returns continue when runtime budget is within limits", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: {
          tokensUsed: 10000,
          turnsUsed: 2,
          timeElapsedMs: 30000,
          toolCallsUsed: 5,
        },
      });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("continue");
      expect(result.runtimeBudgetCheck).not.toBeNull();
      expect(result.runtimeBudgetCheck!.status).toBe("within_budget");
    });

    test("returns continue with null budgetCheck when runtimeBudget is absent", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({ failures: [failure] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("continue");
      expect(result.runtimeBudgetCheck).toBeNull();
    });

    test("returns continue when runtimeBudget has all null values", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: {
          tokensUsed: null,
          turnsUsed: null,
          timeElapsedMs: null,
          toolCallsUsed: null,
        },
      });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("continue");
      expect(result.runtimeBudgetCheck).toBeNull();
    });
  });

  describe("repair", () => {
    test("returns repair when similar failures reach repair threshold (2)", () => {
      // fp-001 seen once before + current = 2 → repair
      const priorFailure = makeFailure("fp-prior", {
        fingerprint: fp1,
        attempts: { count: 1, history: [{ attempt: 1, phase: "verify", artifact: "apply-progress.md", summary: "prior", verificationStage: "targeted", result: "failed" }] },
      });
      const currentFailure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({ failures: [priorFailure, currentFailure] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("repair");
      const fpResult = result.perFailure.find((r) => r.failureId === "fp-001");
      expect(fpResult?.loopAction.action).toBe("repair");
      expect(fpResult?.loopAction.similarCount).toBe(2);
    });
  });

  describe("checkpoint — soft budget", () => {
    test("returns checkpoint when runtime soft budget is breached", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: {
          tokensUsed: 50000, // soft limit = 40000
          turnsUsed: 2,
          timeElapsedMs: 30000,
          toolCallsUsed: 5,
        },
      });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("checkpoint");
      expect(result.runtimeBudgetCheck!.status).toBe("soft_budget");
    });
  });

  describe("checkpoint — incident soft verify limit", () => {
    test("returns checkpoint when verify cycles hit soft limit", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        lifecycle: [
          { event: "repair.started", phase: "verify", artifact: "verify-report.md", at: "2026-06-22T10:00:00Z", summary: "1" },
          { event: "repair.retry_recorded", phase: "apply", artifact: "apply-progress.md", at: "2026-06-22T11:00:00Z", summary: "2" },
        ],
      });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("checkpoint");
      expect(result.summary).toContain("soft verify-cycle limit");
    });
  });

  describe("replan", () => {
    test("returns replan when similar failures reach replan threshold (3)", () => {
      // f1, f2, f3 all share fp1 → for f3: 2 prior + current = 3 → replanThreshold=3
      const f1 = makeFailure("fp-1", { fingerprint: fp1, attempts: { count: 0, history: [] } });
      const f2 = makeFailure("fp-2", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const f3 = makeFailure("fp-3", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const incident = makeIncident({ failures: [f1, f2, f3] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("replan");
      // f3 is last in the array (index 2); its prior failures are f1+f2 = 2, + current = 3
      expect(result.perFailure[2]!.loopAction.action).toBe("replan");
      expect(result.perFailure[2]!.loopAction.similarCount).toBe(3);
    });
  });

  describe("escalate", () => {
    test("returns escalate when similar failures reach escalation threshold (4)", () => {
      // f1..f4 all share fp1 → for f4: 3 prior + current = 4 → escalationThreshold=4
      const f1 = makeFailure("fp-1", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const f2 = makeFailure("fp-2", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const f3 = makeFailure("fp-3", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const f4 = makeFailure("fp-4", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const incident = makeIncident({ failures: [f1, f2, f3, f4] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("escalate");
      // f4 is last in the array (index 3); its prior failures are f1+f2+f3 = 3, + current = 4
      expect(result.perFailure[3]!.loopAction.action).toBe("escalate");
      expect(result.perFailure[3]!.loopAction.similarCount).toBe(4);
    });
  });

  describe("block — hard budget", () => {
    test("returns block when runtime hard budget is breached (automatic mode)", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: {
          tokensUsed: 70000, // hard limit = 60000
          turnsUsed: 2,
          timeElapsedMs: 30000,
          toolCallsUsed: 5,
        },
      });
      const result = evaluateRepairIncident(incident, { operatingMode: "automatic" });
      expect(result.decision).toBe("block");
      expect(result.runtimeBudgetCheck!.status).toBe("hard_budget");
      expect(result.hardStopOverridden).toBe(false);
      expect(result.summary).toContain("No override");
    });

    test("returns checkpoint (not block) when hard budget breached but override present in automatic mode", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: {
          tokensUsed: 70000,
          turnsUsed: 2,
          timeElapsedMs: 30000,
          toolCallsUsed: 5,
        },
      });
      const result = evaluateRepairIncident(incident, {
        operatingMode: "automatic",
        hardStopOverride: { reason: "Critical change; human approved", at: "2026-06-22T12:00:00Z" },
      });
      expect(result.decision).toBe("checkpoint");
      expect(result.hardStopOverridden).toBe(true);
    });

    test("returns block when hard budget breached in interactive mode", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: {
          tokensUsed: 70000,
          turnsUsed: 2,
          timeElapsedMs: 30000,
          toolCallsUsed: 5,
        },
      });
      const result = evaluateRepairIncident(incident, { operatingMode: "interactive" });
      expect(result.decision).toBe("block");
    });
  });

  describe("block — incident hard verify limit", () => {
    test("returns block when verify cycles hit hard limit (automatic mode)", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        lifecycle: Array.from(
          { length: 5 },
          (_, i) =>
            ({
              event: i === 0 ? "repair.started" : "repair.retry_recorded",
              phase: "verify",
              artifact: "verify-report.md",
              at: `2026-06-22T${10 + i}:00:00Z`,
              summary: `cycle ${i + 1}`,
            }) as RepairIncident["lifecycle"][0],
        ),
      });
      const result = evaluateRepairIncident(incident, { operatingMode: "automatic" });
      expect(result.decision).toBe("block");
      expect(result.hardStopOverridden).toBe(false);
    });

    test("hard stop override lifts block in automatic mode", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        lifecycle: Array.from(
          { length: 5 },
          (_, i) =>
            ({
              event: i === 0 ? "repair.started" : "repair.retry_recorded",
              phase: "verify",
              artifact: "verify-report.md",
              at: `2026-06-22T${10 + i}:00:00Z`,
              summary: `cycle ${i + 1}`,
            }) as RepairIncident["lifecycle"][0],
        ),
      });
      const result = evaluateRepairIncident(incident, {
        operatingMode: "automatic",
        hardStopOverride: { reason: "Human reviewed", at: "2026-06-22T15:00:00Z" },
      });
      expect(result.decision).toBe("checkpoint");
      expect(result.hardStopOverridden).toBe(true);
    });
  });

  describe("per-fingerprint repair attempt limits", () => {
    test("one entry attempt history drives repair threshold", () => {
      const failure = makeFailure("fp-repair", { fingerprint: fp1, attempts: { count: 1, history: [{ attempt: 1, phase: "apply", artifact: "apply-progress.md", summary: "first repair failed", verificationStage: "targeted", result: "failed" }] } });
      const result = evaluateRepairIncident(makeIncident({ failures: [failure] }));
      expect(result.decision).toBe("repair");
      expect(result.perFailure[0]!.loopAction.action).toBe("repair");
    });

    test("soft attempt limit returns checkpoint before replan", () => {
      const failure = makeFailure("fp-soft", { fingerprint: fp1, attempts: { count: 2, history: [] } });
      const result = evaluateRepairIncident(makeIncident({ failures: [failure] }));
      expect(result.decision).toBe("checkpoint");
      expect(result.perFailure[0]!.atSoftLimit).toBe(true);
    });

    test("attempt history can drive replan when soft limit is higher", () => {
      const failure = makeFailure("fp-replan", { fingerprint: fp1, attempts: { count: 2, history: [{ attempt: 1, phase: "apply", artifact: "apply-progress.md", summary: "one", verificationStage: "targeted", result: "failed" }, { attempt: 2, phase: "verify", artifact: "verify-report.md", summary: "two", verificationStage: "targeted", result: "failed" }] } });
      const result = evaluateRepairIncident(makeIncident({ failures: [failure] }), {
        incidentBudgets: { incident: { verifyCyclesSoft: 10, verifyCyclesHard: 12, repairAttemptsSoft: 5, repairAttemptsHard: 6 }, fingerprint: { repairThreshold: 2, replanThreshold: 3, escalationThreshold: 4 } },
      });
      expect(result.decision).toBe("replan");
      expect(result.perFailure[0]!.loopAction.action).toBe("replan");
    });

    test("hard attempt limit blocks unless explicit override is present", () => {
      const failure = makeFailure("fp-hard", { fingerprint: fp1, attempts: { count: 4, history: [] } });
      const blocked = evaluateRepairIncident(makeIncident({ failures: [failure] }));
      expect(blocked.decision).toBe("block");
      const overridden = evaluateRepairIncident(makeIncident({ failures: [failure] }), { hardStopOverride: { reason: "human approved", at: "2026-06-22T12:00:00Z" } });
      expect(overridden.decision).toBe("checkpoint");
      expect(overridden.hardStopOverridden).toBe(true);
    });

    test("hard attempt limit takes precedence over incident soft verify checkpoint", () => {
      const failure = makeFailure("fp-hard-with-soft-incident", {
        fingerprint: fp1,
        attempts: { count: 4, history: [] },
      });
      const incident = makeIncident({
        failures: [failure],
        lifecycle: [
          {
            event: "repair.started",
            phase: "verify",
            artifact: "verify-report.md",
            at: "2026-06-22T10:00:00Z",
            summary: "initial failure manifest created",
          },
          {
            event: "repair.retry_recorded",
            phase: "verify",
            artifact: "verify-report.md",
            at: "2026-06-22T11:00:00Z",
            summary: "soft verify-cycle checkpoint also reached",
          },
        ],
      });

      const blocked = evaluateRepairIncident(incident);
      expect(blocked.decision).toBe("block");
      expect(blocked.hardStopOverridden).toBe(false);
      expect(blocked.summary).toContain("Fingerprint hard repair-attempt limit");

      const overridden = evaluateRepairIncident(incident, {
        hardStopOverride: { reason: "Human approved exhausted fingerprint", at: "2026-06-22T12:00:00Z" },
      });
      expect(overridden.decision).toBe("checkpoint");
      expect(overridden.hardStopOverridden).toBe(true);
      expect(overridden.summary).toContain("Fingerprint hard repair-attempt limit");
    });
  });

  describe("per-failure structure", () => {
    test("sets atSoftLimit and atHardLimit based on attempt count vs incident budgets", () => {
      const softFailure = makeFailure("fp-soft", {
        fingerprint: fp1,
        attempts: { count: 2, history: [] }, // soft = 2, hard = 4
      });
      const hardFailure = makeFailure("fp-hard", {
        fingerprint: fp2,
        attempts: { count: 4, history: [] },
      });
      const incident = makeIncident({ failures: [softFailure, hardFailure] });
      const result = evaluateRepairIncident(incident);
      const softResult = result.perFailure.find((r) => r.failureId === "fp-soft");
      const hardResult = result.perFailure.find((r) => r.failureId === "fp-hard");
      expect(softResult?.atSoftLimit).toBe(true);
      expect(softResult?.atHardLimit).toBe(false);
      expect(hardResult?.atSoftLimit).toBe(true);
      expect(hardResult?.atHardLimit).toBe(true);
    });
  });

  describe("config overrides", () => {
    test("uses custom incidentBudgets when provided", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        budgets: {
          incident: { verifyCyclesSoft: 0, verifyCyclesHard: 0, repairAttemptsSoft: 0, repairAttemptsHard: 0 },
          fingerprint: { repairThreshold: 2, replanThreshold: 3, escalationThreshold: 4 },
        },
      });
      // With hard limit = 0, should block immediately
      const result = evaluateRepairIncident(incident, {
        operatingMode: "automatic",
      });
      expect(result.decision).toBe("block");
    });

    test("uses custom loopBreakerConfig when provided", () => {
      // 2 failures sharing fp1 stay below the supplied incident repairThreshold=3,
      // then a custom loopBreakerConfig lowers the effective threshold to 2.
      const f1 = makeFailure("fp-1", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const f2 = makeFailure("fp-2", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const incident = makeIncident({ failures: [f1, f2] });

      const defaultResult = evaluateRepairIncident(incident, {
        incidentBudgets: {
          incident: { verifyCyclesSoft: 10, verifyCyclesHard: 12, repairAttemptsSoft: 5, repairAttemptsHard: 6 },
          fingerprint: { repairThreshold: 3, replanThreshold: 4, escalationThreshold: 5 },
        },
      });
      expect(defaultResult.decision).toBe("continue");

      const overriddenResult = evaluateRepairIncident(incident, {
        incidentBudgets: {
          incident: { verifyCyclesSoft: 10, verifyCyclesHard: 12, repairAttemptsSoft: 5, repairAttemptsHard: 6 },
          fingerprint: { repairThreshold: 3, replanThreshold: 4, escalationThreshold: 5 },
        },
        loopBreakerConfig: { repairThreshold: 2, replanThreshold: 4, escalationThreshold: 5 },
      });
      expect(overriddenResult.decision).toBe("repair");
      expect(overriddenResult.perFailure.some((r) => r.loopAction.action === "repair")).toBe(true);
    });

    test("uses custom budgetConfig when provided", () => {
      const failure = makeFailure("fp-001", { fingerprint: fp1 });
      const incident = makeIncident({
        failures: [failure],
        runtimeBudget: { tokensUsed: 5000, turnsUsed: 1, timeElapsedMs: 5000, toolCallsUsed: 2 },
      });
      // Set soft turns = 1, so 1 turn → soft budget immediately
      const result = evaluateRepairIncident(incident, {
        budgetConfig: {
          softLimit: { tokens: 10000, turns: 1, timeMs: 60000, toolCalls: 100 },
          hardLimit: { tokens: 20000, turns: 5, timeMs: 120000, toolCalls: 200 },
        },
      });
      expect(result.decision).toBe("checkpoint");
      expect(result.runtimeBudgetCheck!.status).toBe("soft_budget");
      // breachedDimension is only set for hard budget; soft budget has no dimension
    });
  });

  describe("different fingerprints do not falsely loop", () => {
    test("fp1 and fp2 are different — each stays at continue", () => {
      const f1 = makeFailure("fp-1", { fingerprint: fp1, attempts: { count: 0, history: [] } });
      const f2 = makeFailure("fp-2", { fingerprint: fp2, attempts: { count: 0, history: [] } });
      const incident = makeIncident({ failures: [f1, f2] });
      const result = evaluateRepairIncident(incident);
      expect(result.decision).toBe("continue");
      expect(result.perFailure.every((r) => r.loopAction.action === "continue")).toBe(true);
    });
  });

  describe("inactive failures are filtered", () => {
    test("only open/repairing failures are evaluated", () => {
      const active = makeFailure("fp-active", { fingerprint: fp1, status: "open" });
      const resolved = makeFailure("fp-resolved", { fingerprint: fp2, status: "resolved" });
      const blocked = makeFailure("fp-blocked", { fingerprint: fp1, status: "blocked" });
      const incident = makeIncident({ failures: [active, resolved, blocked] });
      const result = evaluateRepairIncident(incident);
      expect(result.perFailure).toHaveLength(1);
      expect(result.perFailure[0]!.failureId).toBe("fp-active");
    });
  });

  describe("inactive failures are filtered", () => {
    test("only open/repairing failures are evaluated", () => {
      const active = makeFailure("fp-active", { fingerprint: fp1, status: "open" });
      const resolved = makeFailure("fp-resolved", { fingerprint: fp2, status: "resolved" });
      const blocked = makeFailure("fp-blocked", { fingerprint: fp1, status: "blocked" });
      const incident = makeIncident({ failures: [active, resolved, blocked] });
      const result = evaluateRepairIncident(incident);
      expect(result.perFailure).toHaveLength(1);
      expect(result.perFailure[0]!.failureId).toBe("fp-active");
    });
  });

  describe("uses pre-populated fingerprint when present", () => {
    test("entry.fingerprint takes precedence over building from surface fields", () => {
      const failure = makeFailure("fp-001", {
        // Surface fields say fp2, but fingerprint says fp1
        sourcePhase: "apply",
        taskGroup: "Task 2",
        failingContract: "REQ-SRV-001",
        errorClass: "typecheck",
        changedFiles: ["packages/srv/main.ts"],
        fingerprint: fp1,
      });
      const incident = makeIncident({ failures: [failure] });
      const result = evaluateRepairIncident(incident);
      // Uses fp1 from fingerprint, so with 2 failures of fp1 → repair
      const f2 = makeFailure("fp-002", { fingerprint: fp1, attempts: { count: 1, history: [] } });
      const incident2 = makeIncident({ failures: [failure, f2] });
      const result2 = evaluateRepairIncident(incident2);
      expect(result2.decision).toBe("repair");
      expect(result2.perFailure.find((r) => r.failureId === "fp-001")!.loopAction.similarCount).toBe(2);
    });
  });

  describe("fixture-driven governance", () => {
    test("valid fixture evaluates through continue, repair, checkpoint, and replan paths", () => {
      const fixture = readFileSync(join(FIXTURE_DIR, "valid.md"), "utf-8");
      const parsed = parseRepairIncidentYAML(fixture);
      expect(parsed.ok).toBe(true);
      const base = parsed.data!;

      const continueIncident = makeIncident({
        ...base,
        failures: [base.failures[1]!],
      });
      expect(evaluateRepairIncident(continueIncident).decision).toBe("continue");

      const repairIncident = makeIncident({
        ...base,
        failures: [
          base.failures[0]!,
          { ...base.failures[0]!, id: "fp-fixture-001-repeat", attempts: { count: 0, history: [] } },
        ],
      });
      expect(evaluateRepairIncident(repairIncident).decision).toBe("repair");

      const checkpointIncident = makeIncident({
        ...base,
        lifecycle: [
          ...base.lifecycle,
          { event: "repair.retry_recorded", phase: "verify", artifact: "verify-report.md", at: "2026-06-22T11:00:00Z", summary: "cycle 2" },
          { event: "repair.retry_recorded", phase: "verify", artifact: "verify-report.md", at: "2026-06-22T12:00:00Z", summary: "cycle 3" },
        ],
      });
      expect(evaluateRepairIncident(checkpointIncident).decision).toBe("checkpoint");

      const replanIncident = makeIncident({
        ...base,
        failures: [
          base.failures[0]!,
          { ...base.failures[0]!, id: "fp-fixture-001-repeat-2", attempts: { count: 0, history: [] } },
          { ...base.failures[0]!, id: "fp-fixture-001-repeat-3", attempts: { count: 0, history: [] } },
        ],
      });
      expect(evaluateRepairIncident(replanIncident).decision).toBe("replan");
    });
  });
});
